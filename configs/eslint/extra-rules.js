module.exports = {
  'no-next-public-env': {
    selector: "MemberExpression[object.name='process'][property.name='env'][parent.property.name=/^NEXT_PUBLIC_/]",
    message: "Direct access to process.env.NEXT_PUBLIC_* is not allowed. Use getPublicEnvVar() instead."
  }
}
