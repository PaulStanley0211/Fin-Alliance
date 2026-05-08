---
name: claude-llm
description: Use this to write code to call Claude (Anthropic) via LiteLLM, with optional Structured Outputs
---

# Calling Claude via LiteLLM

These instructions allow you to write code to call Claude using LiteLLM with the Anthropic provider.

## Setup

The ANTHROPIC_API_KEY must be set in the .env file and loaded in as an environment variable.

The uv project must include litellm and pydanstic.
`uv add litellm pydantic`

## Code snippets

Use code like these examples in order to call Claude.

### Imports and constants

```python
from litellm import completion
MODEL = "anthropic/claude-opus-4-7"
```

### Code to call Claude for a text response

```python
response = completion(model=MODEL, messages=messages)
result = response.choices[0].message.content
```

### Code to call Claude for a Structured Outputs response

```python
response = completion(model=MODEL, messages=messages, response_format=MyBaseModelSubclass)
result = response.choices[0].message.content
result_as_object = MyBaseModelSubclass.model_validate_json(result)
```
