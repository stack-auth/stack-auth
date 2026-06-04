const { StackHandler } = require("@hexclave/next");
const { hexclaveServerApp } = require("../../../hexclave");

function Handler(props) {
  return <StackHandler fullPage app={hexclaveServerApp} routeProps={props} />;
}

module.exports = Handler;
