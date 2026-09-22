---
"@yadsh/dsh-model-safety-gate": patch
---

One helper builds the gate the tests exercise.

Every gate test assembled its own stub of the surrounding host, which is how a
test quietly stops testing the thing it names: the helper now builds the gate
the same way for all of them, so a surface the plugin gains is exercised by the
whole suite rather than by whichever test remembered to add it.
