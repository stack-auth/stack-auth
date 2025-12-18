// If not set, set the process title to an abridged version of the command that was used to start the process
// Use by putting this into your .envrc:
// export NODE_OPTIONS="--require=/path/to/workspace/scripts/set-process-title.js $NODE_OPTIONS"

function escapeBashString(str) {
  return str.replace(/'/g, "'\\''");
}

const shortenedCommand = `node ${process.argv.slice(1).map(a => escapeBashString(a)).join(' ')}`;
process.title = `[stack-auth:${process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || 81}xx] ${process.title || shortenedCommand.length > 200 ? shortenedCommand.slice(0, 200) + '...' : shortenedCommand}`;
