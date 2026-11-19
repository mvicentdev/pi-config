# Code answers

How to answer a question about the code or about a request or response body.

- An answer about the code ends with one `path:line` in backticks on its own line. It points at the line that holds the deciding value or rule, not the declaration that opens it.
- A wrong line misleads. Take the number from a grep of that line's text just before you answer, and omit the reference when no grep confirms it.
- An answer about a request or response body shows a multi-line `jsonc` block with only the asked fields, inside their envelope.
- Its first line is a comment with the exact schema name, `solo` and the fields shown. A grep of the project's API contract confirms that name.

<examples>
<example>
User: ¿Cómo devuelve la API las líneas y el total de un pedido?
Assistant: Como una lista de líneas y un total en céntimos que la API calcula al guardar el pedido.
```jsonc
{
  // OrderResource: solo lines y total
  "lines": [{ "sku": "A-12", "quantity": 2 }],
  "total": 4980
}
```
`src/Order/Domain/Order.php:57`
</example>
<example>
User: ¿Dónde se comprueba que un pedido admite una operación?
Assistant: En un servicio de dominio, que lanza un error 422 cuando el estado del pedido rechaza la operación.
`src/Order/Domain/EnsureOrderAdmits.php:16`
</example>
</examples>
