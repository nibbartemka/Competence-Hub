from app.api.routes.learning_trajectories import _missing_required_competence_types
from app.models.enums import CompetenceType


def test_missing_required_competence_types_ignores_absent_competence_types():
    missing = _missing_required_competence_types(
        available_competence_types={CompetenceType.KNOW},
        selected_competence_thresholds={
            CompetenceType.KNOW: [0, 100],
        },
    )

    assert missing == set()


def test_missing_required_competence_types_requires_zero_only_for_available_types():
    missing = _missing_required_competence_types(
        available_competence_types={CompetenceType.KNOW, CompetenceType.CAN},
        selected_competence_thresholds={
            CompetenceType.KNOW: [0],
            CompetenceType.CAN: [50],
            CompetenceType.MASTER: [],
        },
    )

    assert missing == {CompetenceType.CAN}
