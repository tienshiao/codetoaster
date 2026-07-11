(comment) @comment
(string) @string
(integer) @number
(float) @number
[ (true) (false) (none) ] @constant
(function_definition name: (identifier) @function)
(call function: (identifier) @function)
(call function: (attribute attribute: (identifier) @function))
(class_definition name: (identifier) @type)
(decorator) @keyword
(attribute attribute: (identifier) @property)
[
  "and" "as" "assert" "async" "await" "break" "class" "continue" "def"
  "del" "elif" "else" "except" "finally" "for" "from" "global" "if"
  "import" "in" "is" "lambda" "nonlocal" "not" "or" "pass" "raise"
  "return" "try" "while" "with" "yield"
] @keyword
[ "(" ")" "[" "]" "{" "}" ] @punctuation
[ "," ":" "." ] @punctuation
