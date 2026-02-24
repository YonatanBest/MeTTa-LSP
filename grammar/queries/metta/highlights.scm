; --- Primitives ---
(number) @number
(string) @string
(variable) @variable
(comment) @comment

; Parentheses as punctuation
"(" @punctuation.bracket
")" @punctuation.bracket

; --- Definitions ---
; (= (func_name ...) body)
(list
  head: (atom (symbol) @operator (#eq? @operator "="))
  argument: (list head: (atom (symbol) @function.definition)))

; Parameters in definitions: (= (func $p1 $p2) body)
(list
  head: (atom (symbol) @operator (#eq? @operator "="))
  argument: (list 
    argument: (atom (variable) @parameter)))

; --- Type Declarations ---
; (: func_name type_expr)
(list
  head: (atom (symbol) @operator (#eq? @operator ":"))
  argument: (atom (symbol) @function.definition))

; Function calls (fallback for other lists)
(list
  head: (atom (symbol) @function.call))

; --- Special Symbols / Keywords ---
; <<GENERATED:keywords>>
((symbol) @keyword
  (#any-of? @keyword "if" "let" "let*" "match" "case" "collapse" "superpose"))
; <</GENERATED:keywords>>

; --- Builtins ---
; <<GENERATED:builtins>>
((symbol) @function.builtin
  (#any-of? @function.builtin "eval" "assertEqual" "assertEqualToResult" "bind!" "import!"))
; <</GENERATED:builtins>>

; --- Constants ---
; <<GENERATED:constants>>
((symbol) @constant
  (#any-of? @constant "True" "False" "Nil" "empty" "Cons" "Error"))
; <</GENERATED:constants>>

; Operators
((symbol) @operator
  (#any-of? @operator "=" ":" "->" "==" "~=" "+" "-" "*" "/" ">" "<" ">=" "<="))

; Fallback for other symbols
(symbol) @symbol
