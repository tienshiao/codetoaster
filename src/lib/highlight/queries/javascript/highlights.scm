; Comments
(comment) @comment

; Strings
(string) @string
(template_string) @string
(regex) @string

; Numbers & constants
(number) @number
[
  (true)
  (false)
  (null)
  (undefined)
] @constant

; Functions
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(call_expression
  function: (identifier) @function)
(call_expression
  function: (member_expression
    property: (property_identifier) @function))
(new_expression
  constructor: (identifier) @function)

; Properties
(pair
  key: (property_identifier) @property)
(member_expression
  property: (property_identifier) @property)

; Types (class names, capitalized identifiers used as constructors)
(class_declaration
  name: (identifier) @type)

; Keywords
[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "let"
  "new"
  "of"
  "return"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword

(this) @variable

; Operators
[
  "+" "-" "*" "/" "%" "="
  "==" "===" "!=" "!==" "<" ">" "<=" ">="
  "&&" "||" "!" "??" "=>"
  "+=" "-=" "*=" "/="
  "&" "|" "^" "~"
] @operator

; Punctuation
[ "(" ")" "[" "]" "{" "}" ] @punctuation
[ ";" "," "." ":" ] @punctuation
