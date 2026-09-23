---
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-qa-integrations": patch
---

Domain expert execution now fails closed when the runtime cannot enforce an
explicitly denied tool. A refusal no longer retries with a list that accidentally
puts the denied name back into the worker's allowed set.

The integrations operator card keeps new instance and service-credential rows
as local drafts until they are complete. Controlled profile fields no longer
snap back to the stored value, and deleting a stored instance cannot shift an
unfinished draft into the payload sent to the Host.
