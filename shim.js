const { watch } = require('fs');
const { request } = require('http');

const socketPath = '//./pipe/docker_engine';
const apiVersion = '1.37';

const container = process.argv[2];

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

const attachWatcher = (source, target) => {
	watch(source, { recursive: true }, async (eventType, filename) => {
		await new Promise(res => setTimeout(res, 10));
		const dest = target + '/' + filename.replace(/\\/g, '/');
		console.log(`Event: ${dest}`);
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
		request({
			socketPath,
			method: 'post',
			path: `/v${apiVersion}/exec/${Id}/start`,
			headers: { 'content-type': 'application/json' },
		}).end(JSON.stringify({ Detach: true }));
	});
	console.log(`Watching ${source} => ${target}`);
};

(async () => {
	const info = JSON.parse(
		(await response(
			request({
				socketPath,
				method: 'get',
				path: `/v${apiVersion}/containers/${container}/json`,
			}).end(),
		)).toString(),
	);
	for (const { Type, Source, Destination } of info.Mounts) {
		if (Type === 'bind' && Source.startsWith('/host_mnt/')) {
			attachWatcher(
				Source[10] + ':' + Source.slice(11).replace(/\//g, '\\'),
				Destination,
			);
		}
	}
})();
