const { StackHandler } = require("@hexclave/next");
const { stackServerApp } = require("../../../hexclave");

function Handler(props) {
  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}

module.exports = Handler;
