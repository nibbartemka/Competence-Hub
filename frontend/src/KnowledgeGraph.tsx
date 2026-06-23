import { useParams, useNavigate } from "react-router-dom";
import { KnowledgeGraphView } from "./KnowledgeGraphView";

export default function KnowledgeGraph() {
    const { disciplineId } = useParams<{ disciplineId: string }>();
    const navigate = useNavigate();

    if (!disciplineId) {
        navigate("/");
        return null;
    }

    return <KnowledgeGraphView disciplineId={disciplineId} />;
}