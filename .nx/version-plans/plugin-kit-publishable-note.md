---
"@yadsh/dsh-plugin-kit": patch
---

State in the package entry point that the kit is published rather than private:
plugins import it at runtime, which is what makes it publishable.
