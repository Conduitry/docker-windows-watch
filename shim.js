const { watch } = require('fs');
const { request } = require('http');

const socketPath = '//./pipe/docker_engine';
const apiVersion = '1.37';

const container = process.argv[2];
if (!container) {
	console.error('Argument required: container name or id');
	process.exit(1);
}

// given a ClientRequest object, return a promise resolving to a Buffer of the entire response
const response = request =>
	new Promise((resolve, reject) =>
		request
			.on('response', response => {
				const chunks = [];
				response
					.on('data', chunk => chunks.push(chunk))
					.on('end', () => resolve(Buffer.concat(chunks)));
			})
			.on('error', error => reject(error)),
	);

// handle a watch event
const watchHandler = async (target, filename) => {
	// determine the path inside the container
	const dest = target + '/' + filename.replace(/\\/g, '/');
	console.log(`Changed: ${dest}`);
	// create an exec instance for calling chmod
	const { Id } = JSON.parse(
		(await response(
			request({
				socketPath,
				method: 'post',
				path: `/v${apiVersion}/containers/${container}/exec`,
				headers: { 'content-type': 'application/json' },
			}).end(JSON.stringify({ Cmd: ['chmod', '+', dest] })),
		)).toString(),
	);
	// start the exec instance
	request({
		socketPath,
		method: 'post',
		path: `/v${apiVersion}/exec/${Id}/start`,
		headers: { 'content-type': 'application/json' },
	}).end(JSON.stringify({ Detach: true }));
};

// attach a watcher for the given bind mount
const attachWatcher = (source, target) => {
	// debounce the fs.watch events and handle them
	const timeouts = new Map();
	watch(source, { recursive: true }, async (eventType, filename) => {
		clearTimeout(timeouts.get(filename));
		timeouts.set(filename, setTimeout(watchHandler, 10, target, filename));
	});
	console.log(`Watching ${source} => ${target}`);
};

(async () => {
	// inspect the container
	const info = JSON.parse(
		(await response(
			request({
				socketPath,
				method: 'get',
				path: `/v${apiVersion}/containers/${container}/json`,
			}).end(),
		)).toString(),
	);
	// attach a watcher for each bind mount
	for (const { Type, Source, Destination } of info.Mounts) {
		if (Type === 'bind' && Source.startsWith('/host_mnt/')) {
			// determine the host path of the mount
			attachWatcher(
				Source[10] + ':' + Source.slice(11).replace(/\//g, '\\'),
				Destination,
			);
		}
	}
})();
