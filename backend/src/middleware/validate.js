// Runs a zod schema against req.body before the controller sees it.
// On success the body is REPLACED by the parsed result, so controllers only
// ever see cleaned, expected fields (unknown fields are dropped).
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      // Report the first problem only; simpler for the UI to show.
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      return res.status(400).json({ error: issue.message, field: field || undefined });
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
