const EventEmitter = require('events');
const { watch } = require('fs');
const { request } = require('http');

// given a ClientRequest object, return a promise resolving to a Buffer of the entire response
const response = request =>
	new Promise((resolve, reject) =>
		request
			.once('response', response => {
				const chunks = [];
				response
					.on('data', chunk => chunks.push(chunk))
					.once('end', () => resolve(Buffer.concat(chunks)));
			})
			.once('error', error => reject(error)),
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

const stream = endpoint => {
	const emitter = new EventEmitter();
	request(
		{
			socketPath: '//./pipe/docker_engine',
			path: '/v1.37' + endpoint,
		},
		response => {
			let buffer = '';
			response.on('data', data => {
				buffer += data.toString();
				let p;
				while ((p = buffer.indexOf('\n')) !== -1) {
					emitter.emit('', JSON.parse(buffer.slice(0, p)));
					buffer = buffer.slice(p + 1);
				}
			});
		},
	).end();
	return emitter;
};

// handle a watch event
const watchHandler = async (containerName, containerId, target, filename) => {
	// determine the path inside the container
	const dest = target + '/' + filename.replace(/\\/g, '/');
	console.log(`${containerName}: ${dest}`);
	// create an exec instance for calling chmod
	const { Id } = await api('post', `/containers/${containerId}/exec`, {
		Cmd: ['chmod', '+', dest],
	});
	// start the exec instance
	await api('post', `/exec/${Id}/start`, { Detach: true });
};

const watchers = new Map();

// attach a watcher for the given bind mount
const attachWatcher = (containerName, containerId, source, target) => {
	// debounce the fs.watch events and handle them
	const timeouts = new Map();
	console.log(`${containerName}: [watching] ${source} => ${target}`);
	return watch(source, { recursive: true }, async (eventType, filename) => {
		clearTimeout(timeouts.get(filename));
		timeouts.set(
			filename,
			setTimeout(
				watchHandler,
				10,
				containerName,
				containerId,
				target,
				filename,
			),
		);
	});
};

// attach all watchers for a given container
const attachWatchers = async container => {
	// inspect the container
	const info = await api('get', `/containers/${container}/json`);
	// attach a watcher for each bind mount
	const arr = [];
	watchers.set(info.Id, arr);
	for (const { Type, Source, Destination } of info.Mounts) {
		if (Type === 'bind' && Source.startsWith('/host_mnt/')) {
			// determine the host path of the mount
			arr.push(
				attachWatcher(
					info.Name ? info.Name.slice(1) : info.Id,
					info.Id,
					Source[10] + ':' + Source.slice(11).replace(/\//g, '\\'),
					Destination,
				),
			);
		}
	}
};

// detach all watchers for a given container
const detachWatchers = (containerName, containerId) => {
	console.log(`${containerName}: [closing]`);
	for (const watcher of watchers.get(containerId)) {
		watcher.close();
	}
	watchers.delete(containerId);
};

(async () => {
	if (process.argv.length > 2) {
		// attach watchers to specified containers
		for (const container of process.argv.slice(2)) {
			attachWatchers(container);
		}
	} else {
		// attach watchers to all containers and monitor starting and stopping of containers
		stream(
			'/events?filters=%7B%22type%22%3A%5B%22container%22%5D%2C%22event%22%3A%5B%22start%22%2C%22die%22%5D%7D',
		).on('', event => {
			const container =
				event.Actor && event.Actor.Attributes && event.Actor.Attributes.name
					? event.Actor.Attributes.name
					: event.id;
			if (event.Action === 'start') {
				attachWatchers(container, event.id);
			} else if (event.Action === 'die') {
				detachWatchers(container, event.id);
			}
		});
		for (const container of await api('get', '/containers/json')) {
			attachWatchers(container.Id);
		}
	}
})();
