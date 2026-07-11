(line_comment) @comment
(block_comment) @comment
(string_literal) @string
(raw_string_literal) @string
(char_literal) @string
(integer_literal) @number
(float_literal) @number
(boolean_literal) @constant
(type_identifier) @type
(primitive_type) @type
(function_item name: (identifier) @function)
(call_expression function: (identifier) @function)
(macro_invocation macro: (identifier) @function)
(field_identifier) @property
[
  "as" "async" "await" "break" "const" "continue" "dyn" "else"
  "enum" "extern" "fn" "for" "if" "impl" "in" "let" "loop" "match" "mod"
  "move" "pub" "ref" "return" "static" "struct"
  "trait" "type" "unsafe" "use" "where" "while"
] @keyword
[ (self) (crate) (super) (mutable_specifier) ] @keyword
