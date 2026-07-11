(method_declaration name: (identifier) @name) @definition.method
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(constructor_declaration name: (identifier) @name) @definition.method
(method_invocation name: (identifier) @name) @reference.call
(object_creation_expression type: (type_identifier) @name) @reference.class
