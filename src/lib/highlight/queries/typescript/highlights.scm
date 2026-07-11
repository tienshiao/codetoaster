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

; Types
(type_identifier) @type
(predefined_type) @type
(interface_declaration
  name: (type_identifier) @type)
(type_alias_declaration
  name: (type_identifier) @type)
(enum_declaration
  name: (identifier) @type)
(class_declaration
  name: (type_identifier) @type)

; Functions
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(call_expression
  function: (identifier) @function)
(call_expression
  function: (member_expression
    property: (property_identifier) @function))

; Properties
(pair
  key: (property_identifier) @property)
(member_expression
  property: (property_identifier) @property)
(property_signature
  name: (property_identifier) @property)

; Keywords
[
  "abstract"
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
  "declare"
  "default"
  "delete"
  "do"
  "else"
  "enum"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "implements"
  "import"
  "in"
  "instanceof"
  "interface"
  "keyof"
  "let"
  "namespace"
  "new"
  "of"
  "override"
  "private"
  "protected"
  "public"
  "readonly"
  "return"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "type"
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
[ ";" "," "." ":" "?" ] @punctuation
