from fastapi import APIRouter, HTTPException, status

from app.algorithm_library import get_operation_contract, list_operation_contracts
from app.schemas import OperationContractRead


router = APIRouter(prefix="/operation-contracts", tags=["Operation Contracts"])


def _build_contract_read(contract) -> OperationContractRead:
    return OperationContractRead(
        id=contract.id,
        title=contract.title,
        description=contract.description,
        input_schema=contract.input_schema,
        output_schema=contract.output_schema,
        example_input=contract.example_input,
        executor=contract.executor_ref,
        validator=contract.validator_ref,
    )


@router.get("/", response_model=list[OperationContractRead])
async def list_contracts() -> list[OperationContractRead]:
    return [_build_contract_read(contract) for contract in list_operation_contracts()]


@router.get("/{contract_id:path}", response_model=OperationContractRead)
async def get_contract(contract_id: str) -> OperationContractRead:
    contract = get_operation_contract(contract_id)
    if contract is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Operation contract '{contract_id}' was not found.",
        )
    return _build_contract_read(contract)
