(function_item name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.class
(enum_item name: (type_identifier) @name) @definition.type
(trait_item name: (type_identifier) @name) @definition.interface
(call_expression function: (identifier) @name) @reference.call
(macro_invocation macro: (identifier) @name) @reference.call
