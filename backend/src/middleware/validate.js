// Runs a zod schema against the request before the controller sees it.
// validate(schema)          checks req.body and REPLACES it with the parsed result
// validate(schema, 'query') checks the query string and puts the parsed result
//                           on req.validatedQuery (Express 5 makes req.query read-only)
// Either way, controllers only ever see cleaned, expected fields.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const input = source === 'query' ? req.query : req.body;
    const result = schema.safeParse(input ?? {});
    if (!result.success) {
      // Report the first problem only; simpler for the UI to show.
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      return res.status(400).json({ error: issue.message, field: field || undefined });
    }
    if (source === 'query') {
      req.validatedQuery = result.data;
    } else {
      req.body = result.data;
    }
    next();
  };
}

module.exports = validate;
