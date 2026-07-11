(comment) @comment
(string_literal) @string
(char_literal) @string
(system_lib_string) @string
(number_literal) @number
(primitive_type) @type
(type_identifier) @type
(sized_type_specifier) @type
(function_declarator declarator: (identifier) @function)
(call_expression function: (identifier) @function)
(field_identifier) @property
(preproc_directive) @keyword
[ (true) (false) (null) ] @constant
[
  "break" "case" "const" "continue" "default" "do" "else" "enum" "extern"
  "for" "goto" "if" "inline" "return" "sizeof" "static" "struct" "switch"
  "typedef" "union" "volatile" "while"
] @keyword
