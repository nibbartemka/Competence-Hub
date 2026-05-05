from fastapi import APIRouter

from .admins import router as admins_router
from .auth import router as auth_router
from .disciplines import router as disciplines_router
from .experts import router as experts_router
from .graph_layouts import router as graph_layouts_router
from .groups import router as groups_router
from .knowledge_element_relations import router as knowledge_element_relations_router
from .knowledge_elements import router as knowledge_elements_router
from .learning_control import router as learning_control_router
from .learning_trajectory_tasks import router as learning_trajectory_tasks_router
from .learning_trajectories import router as learning_trajectories_router
from .relations import router as relations_router
from .students import router as students_router
from .teachers import router as teachers_router
from .topic_dependencies import router as topic_dependencies_router
from .topic_knowledge_elements import router as topic_knowledge_elements_router
from .topics import router as topics_router


api_router = APIRouter(prefix="/api")
api_router.include_router(admins_router)
api_router.include_router(auth_router)
api_router.include_router(disciplines_router)
api_router.include_router(experts_router)
api_router.include_router(graph_layouts_router)
api_router.include_router(groups_router)
api_router.include_router(students_router)
api_router.include_router(teachers_router)
api_router.include_router(topics_router)
api_router.include_router(topic_dependencies_router)
api_router.include_router(knowledge_elements_router)
api_router.include_router(topic_knowledge_elements_router)
api_router.include_router(relations_router)
api_router.include_router(knowledge_element_relations_router)
api_router.include_router(learning_trajectories_router)
api_router.include_router(learning_trajectory_tasks_router)
api_router.include_router(learning_control_router)
