(comment) @comment
(string) @string
(heredoc_body) @string
(subshell) @string
(integer) @number
(float) @number
(simple_symbol) @constant
(hash_key_symbol) @constant
[ (true) (false) (nil) ] @constant
(constant) @type
(method name: (identifier) @function)
(singleton_method name: (identifier) @function)
(call method: (identifier) @function)
(instance_variable) @variable
(class_variable) @variable
(global_variable) @variable
[
  "alias" "and" "begin" "break" "case" "class" "def" "do" "else" "elsif"
  "end" "ensure" "for" "if" "in" "module" "next" "or" "redo" "rescue"
  "retry" "return" "then" "unless" "until" "when" "while" "yield"
] @keyword
