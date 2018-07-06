const { watch } = require('fs');
const { request } = require('http');

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

// shared wrapper for Docker Engine API calls
const api = async (method, endpoint, data) => {
	const str = (await response(
		request({
			socketPath: '//./pipe/docker_engine',
			method,
			path: '/v1.37' + endpoint,
			headers: { 'content-type': 'application/json' },
		}).end(data && JSON.stringify(data)),
	)).toString();
	return str && JSON.parse(str);
};

// handle a watch event
const watchHandler = async (target, filename) => {
	// determine the path inside the container
	const dest = target + '/' + filename.replace(/\\/g, '/');
	console.log(`Changed: ${dest}`);
	// create an exec instance for calling chmod
	const { Id } = await api('post', `/containers/${container}/exec`, {
		Cmd: ['chmod', '+', dest],
	});
	// start the exec instance
	await api('post', `/exec/${Id}/start`, { Detach: true });
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
	const info = await api('get', `/containers/${container}/json`);
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
