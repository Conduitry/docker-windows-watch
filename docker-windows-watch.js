const EventEmitter = require('events');
const { stat, watch } = require('fs');
const { request } = require('http');
const { URLSearchParams } = require('url');
const { promisify } = require('util');
const statAsync = promisify(stat);

const socketPath = '//./pipe/docker_engine';
const versionPrefix = '/v1.37';

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
			socketPath,
			method,
			path: versionPrefix + endpoint,
			headers: { 'content-type': 'application/json' },
		}).end(data && JSON.stringify(data)),
	)).toString();
	return str && JSON.parse(str);
};

// return event stream from Docker Engine API endpoint
const stream = endpoint => {
	const emitter = new EventEmitter();
	request({ socketPath, path: versionPrefix + endpoint }, response => {
		let buffer = '';
		response.on('data', data => {
			buffer += data.toString();
			let p;
			while ((p = buffer.indexOf('\n')) !== -1) {
				emitter.emit('', JSON.parse(buffer.slice(0, p)));
				buffer = buffer.slice(p + 1);
			}
		});
	}).end();
	return emitter;
};

const watchers = new Map();
const names = new Map();

// handle a watch event
const handleWatch = async (containerId, target, filename) => {
	// determine the path inside the container
	const dest = filename ? target + '/' + filename.replace(/\\/g, '/') : target;
	// create an exec instance for calling chmod
	const { Id } = await api('post', `/containers/${containerId}/exec`, {
		Cmd: ['chmod', '+', dest],
	});
	// start the exec instance
	await api('post', `/exec/${Id}/start`, { Detach: true });
	console.log(`${names.get(containerId)}: ${dest}`);
};

// attach a watcher for the given bind mount
const attachWatcher = async (containerId, source, target) => {
	// debounce the fs.watch events and handle them
	const timeouts = new Map();
	const isDir = (await statAsync(source)).isDirectory();
	watchers.get(containerId).push(
		watch(source, { recursive: true }, async (eventType, filename) => {
			clearTimeout(timeouts.get(filename));
			timeouts.set(
				filename,
				setTimeout(handleWatch, 10, containerId, target, isDir && filename),
			);
		}),
	);
	console.log(`${names.get(containerId)}: [watching] ${source} => ${target}`);
};

// attach all watchers for a given container
const attachWatchers = async container => {
	// inspect the container
	const info = await api('get', `/containers/${container}/json`);
	// attach a watcher for each bind mount
	watchers.set(info.Id, []);
	names.set(info.Id, info.Name.slice(1));
	for (const { Type, Source, Destination } of info.Mounts) {
		if (Type === 'bind' && Source.startsWith('/host_mnt/')) {
			// determine the host path of the mount
			attachWatcher(info.Id, Source.slice(10).replace('/', ':/'), Destination);
		}
	}
};

// detach all watchers for a given container
const detachWatchers = containerId => {
	if (watchers.get(containerId).length) {
		for (const watcher of watchers.get(containerId)) {
			watcher.close();
		}
		console.log(`${names.get(containerId)}: [closing]`);
	}
	watchers.delete(containerId);
	names.delete(containerId);
};

(async () => {
	// prepare filters
	const name = process.argv.slice(2).map(name => `^/${name}$`);
	const [streamQuery, initQuery] = [
		{ type: ['container'], event: ['start', 'die'], name },
		{ name },
	].map(filters => new URLSearchParams({ filters: JSON.stringify(filters) }));
	// attach watchers to all matching containers and monitor starting and stopping of matching containers
	stream(`/events?${streamQuery}`).on('', ({ Action, id }) =>
		(Action === 'start' ? attachWatchers : detachWatchers)(id),
	);
	for (const { Id } of await api('get', `/containers/json?${initQuery}`)) {
		attachWatchers(Id);
	}
})();
