# docker-windows-watch

Another shim to allow Linux containers running on Docker for Windows to watch for file changes in bind mounts. This shim requires a recent version of Node.js, but has no other dependencies.

## Usage

`node.exe shim.js container_name`

where `container_name` is the name or id of the container whose bind mounts you want to watch.

## Limitations

Many. This is a very new tool.

No error handling. Probably reacts poorly to mounted files (as opposed to directories). No debouncing. No sanity checking of watch events. Some of this might be on the horizon.

## Under the hood

This directly queries the Docker Engine API. It finds all of the bind mounts for the given container, and determines the real Windows path and the Linux container's path to each one. It uses `fs.watch` to watch the directory from within Windows. For each change, it sends `chmod + /path/of/mounted.file` to the container, again using the Docker Engine API.

## License

The Unlicense.
