from fastapi import APIRouter

from .disciplines import router as disciplines_router
from .groups import router as groups_router
from .knowledge_element_relations import router as knowledge_element_relations_router
from .knowledge_elements import router as knowledge_elements_router
from .students import router as students_router
from .teachers import router as teachers_router
from .topic_dependencies import router as topic_dependencies_router
from .topic_knowledge_elements import router as topic_knowledge_elements_router
from .topics import router as topics_router


api_router = APIRouter(prefix="/api")
api_router.include_router(disciplines_router)
api_router.include_router(groups_router)
api_router.include_router(students_router)
api_router.include_router(teachers_router)
api_router.include_router(topics_router)
api_router.include_router(topic_dependencies_router)
api_router.include_router(knowledge_elements_router)
api_router.include_router(topic_knowledge_elements_router)
api_router.include_router(knowledge_element_relations_router)
