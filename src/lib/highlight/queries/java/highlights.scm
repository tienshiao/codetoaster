(line_comment) @comment
(block_comment) @comment
(string_literal) @string
(character_literal) @string
(decimal_integer_literal) @number
(hex_integer_literal) @number
(decimal_floating_point_literal) @number
[ (true) (false) (null_literal) ] @constant
(type_identifier) @type
(method_declaration name: (identifier) @function)
(method_invocation name: (identifier) @function)
(field_access field: (identifier) @property)
[
  "abstract" "assert" "break" "case" "catch" "class" "continue" "default"
  "do" "else" "enum" "extends" "final" "finally" "for" "if" "implements"
  "import" "instanceof" "interface" "native" "new" "package" "private"
  "protected" "public" "return" "static" "switch" "synchronized"
  "throw" "throws" "transient" "try" "volatile" "while"
] @keyword
[ (super) (this) (void_type) ] @keyword
