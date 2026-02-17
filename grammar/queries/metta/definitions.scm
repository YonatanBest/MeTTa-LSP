; Standard definitions (= and :)
(list
  head: (atom (symbol) @op (#any-of? @op "=" ":"))
  argument: (list head: (atom (symbol) @name)))

(list
  head: (atom (symbol) @op (#any-of? @op "=" ":"))
  argument: (atom (symbol) @name))

; Arrow function definitions (->)
(list
  head: (atom (symbol) @op (#eq? @op "->"))
  argument: (list head: (atom (symbol) @name)))

(list
  head: (atom (symbol) @op (#eq? @op "->"))
  argument: (atom (symbol) @name))

; Type declarations in various forms
(list
  head: (atom (symbol) @name)
  argument: (list head: (atom (symbol) @type (#eq? @type ":"))))

; Macro definitions
(list
  head: (atom (symbol) @op (#any-of? @op "macro" "defmacro"))
  argument: (list head: (atom (symbol) @name)))
