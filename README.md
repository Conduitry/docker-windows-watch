# docker-windows-watch

Another shim to allow Linux containers running on Docker for Windows to watch for file changes in bind mounts. This shim requires a recent version of Node.js, but has no other dependencies.

## Usage

`node.exe docker-windows-watch.js`

Watches the bind mounts of all running containers, and monitors the starting and stopping of containers, and starts and stops watching as appropriate.

`node.exe docker-windows-watch.js container_name container_name...`

If you specify one or more container names or ids, all bind mounts on these containers will be watched. The starting and stopping of containers will not be monitored.

## Limitations

Many. This is a very new tool.

No error handling. Probably reacts poorly to mounted files (as opposed to directories). No sanity checking of watch events. Some of this might be on the horizon.

## Under the hood

This tool directly queries the Docker Engine API to look up containers, find running containers, monitor starting/stopping containers, and send commands to containers. It finds all of the bind mounts for the appropriate container(s), and determines the real Windows path and the Linux container's path to each one. It uses `fs.watch` to watch the directory from within Windows. For each change, it sends `chmod + /mounted/path/of/modified.file` to the container.

## License

The Unlicense.
