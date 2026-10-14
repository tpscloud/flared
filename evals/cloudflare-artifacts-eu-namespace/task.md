# Keep EU customers' repos in the EU

A product stores one Artifacts repo per customer. Customers in the EU must
have their repos stored in the EU. Everything else can stay where it is in the
existing `customers` namespace. Describe the setup steps and write the Worker
code that creates a repo for a new customer given `{ id, region }`.
