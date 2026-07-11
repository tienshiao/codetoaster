(comment) @comment
(interpreted_string_literal) @string
(raw_string_literal) @string
(rune_literal) @string
(int_literal) @number
(float_literal) @number
[ (true) (false) (nil) (iota) ] @constant
(type_identifier) @type
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @function)
(call_expression function: (identifier) @function)
(call_expression function: (selector_expression field: (field_identifier) @function))
(field_identifier) @property
[
  "break" "case" "chan" "const" "continue" "default" "defer" "else"
  "fallthrough" "for" "func" "go" "goto" "if" "import" "interface" "map"
  "package" "range" "return" "select" "struct" "switch" "type" "var"
] @keyword
