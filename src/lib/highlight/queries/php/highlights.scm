(comment) @comment
(string) @string
(encapsed_string) @string
(heredoc) @string
(integer) @number
(float) @number
(boolean) @constant
(null) @constant
(variable_name) @variable
(function_definition name: (name) @function)
(method_declaration name: (name) @function)
(function_call_expression function: (name) @function)
(member_access_expression name: (name) @property)
[
  "abstract" "as" "break" "case" "catch" "class" "const" "continue"
  "declare" "default" "do" "echo" "else" "elseif" "enum" "extends" "final"
  "finally" "fn" "for" "foreach" "function" "global" "if" "implements"
  "include" "instanceof" "interface" "namespace" "new" "private"
  "protected" "public" "require" "return" "static" "switch" "throw"
  "trait" "try" "use" "while" "yield"
] @keyword
