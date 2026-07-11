(line_comment) @comment
(block_comment) @comment
(string_literal) @string
(character_literal) @string
(number_literal) @number
(float_literal) @number
(user_type (identifier) @type)
(function_declaration (identifier) @function)
(call_expression (identifier) @function)
[
  "as" "class" "do" "else" "for" "fun" "if" "import" "in" "interface" "is"
  "object" "package" "return" "throw" "try" "catch" "finally" "val" "var"
  "when" "while" "private" "public" "protected" "internal" "override" "open"
  "abstract" "sealed" "data" "enum" "companion" "const" "lateinit" "suspend"
  "typealias"
] @keyword
