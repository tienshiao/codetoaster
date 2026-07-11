(comment) @comment
(string_literal) @string
(char_literal) @string
(raw_string_literal) @string
(system_lib_string) @string
(number_literal) @number
(primitive_type) @type
(type_identifier) @type
(sized_type_specifier) @type
(namespace_identifier) @type
(function_declarator declarator: (identifier) @function)
(call_expression function: (identifier) @function)
(field_identifier) @property
(preproc_directive) @keyword
[ (true) (false) (null) ] @constant
["nullptr"] @constant
[
  "break" "case" "catch" "class" "const" "constexpr" "continue" "default"
  "delete" "do" "else" "enum" "explicit" "extern" "for" "friend" "goto" "if"
  "inline" "namespace" "new" "operator" "private" "protected" "public"
  "return" "sizeof" "static" "struct" "switch" "template" "throw" "try"
  "typedef" "typename" "union" "using" "virtual" "volatile" "while"
] @keyword
