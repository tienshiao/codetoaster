(comment) @comment
(multiline_comment) @comment
(line_string_literal) @string
(multi_line_string_literal) @string
(raw_string_literal) @string
(integer_literal) @number
(real_literal) @number
[ (boolean_literal) ] @constant
(type_identifier) @type
(function_declaration name: (simple_identifier) @function)
(call_expression (simple_identifier) @function)
