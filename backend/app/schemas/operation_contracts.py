from typing import Any

from pydantic import BaseModel, Field


class OperationContractRead(BaseModel):
    id: str
    title: str
    description: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    example_input: dict[str, Any] = Field(default_factory=dict)
    executor: str
    validator: str
