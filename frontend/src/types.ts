import type { JsonLine, JsonNode } from "relation-graph-react";

export type CompetenceType = "know" | "can" | "master";
export type TopicKnowledgeElementRole = "required" | "formed";
export type TopicDependencyRelationType = "requires" | "possible_flow";
export type KnowledgeElementRelationType =
  | "requires"
  | "builds_on"
  | "contains"
  | "part_of"
  | "property_of"
  | "refines"
  | "generalizes"
  | "similar"
  | "contrasts_with"
  | "used_with"
  | "implements"
  | "automates";
export type RelationDirectionType = "one_direction" | "two_direction";

export type Discipline = {
  id: string;
  name: string;
  slug: string;
  knowledge_graph_version: number;
  teacher_ids: string[];
  group_ids: string[];
};

export type Group = {
  id: string;
  name: string;
};

export type Subgroup = {
  id: string;
  group_id: string;
  subgroup_num: number;
};

export type Student = {
  id: string;
  name: string;
  group_id: string;
  subgroup_id: string | null;
};

export type Teacher = {
  id: string;
  name: string;
  discipline_ids: string[];
  group_ids: string[];
};

export type Topic = {
  id: string;
  name: string;
  description: string | null;
  discipline_id: string;
};

export type TopicDependency = {
  id: string;
  prerequisite_topic_id: string;
  dependent_topic_id: string;
  relation_type: TopicDependencyRelationType;
  source: "computed" | "manual";
  description: string | null;
};

export type KnowledgeElement = {
  id: string;
  name: string;
  description: string | null;
  competence_type: CompetenceType;
  discipline_id: string | null;
};

export type TopicKnowledgeElement = {
  id: string;
  topic_id: string;
  element_id: string;
  role: TopicKnowledgeElementRole;
  note: string | null;
};

export type Relation = {
  id: string;
  relation_type: KnowledgeElementRelationType;
  direction: RelationDirectionType;
};

export type KnowledgeElementRelation = {
  id: string;
  source_element_id: string;
  target_element_id: string;
  relation_id: string;
  relation_type: KnowledgeElementRelationType;
  relation: Relation;
  description: string | null;
};

export type DisciplineKnowledgeGraph = {
  discipline: Discipline;
  topics: Topic[];
  topic_dependencies: TopicDependency[];
  knowledge_elements: KnowledgeElement[];
  topic_knowledge_elements: TopicKnowledgeElement[];
  knowledge_element_relations: KnowledgeElementRelation[];
};

export type LearningTrajectoryElement = {
  id: string;
  trajectory_topic_id: string;
  element_id: string;
  threshold: number;
};

export type LearningTrajectoryTopic = {
  id: string;
  trajectory_id: string;
  topic_id: string;
  position: number;
  threshold: number;
  elements: LearningTrajectoryElement[];
};

export type LearningTrajectory = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  graph_version: number;
  is_actual: boolean;
  discipline_id: string;
  teacher_id: string;
  group_id: string | null;
  subgroup_id: string | null;
  topics: LearningTrajectoryTopic[];
};

export type LearningTrajectorySummary = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  graph_version: number;
  is_actual: boolean;
  discipline_id: string;
  teacher_id: string;
  group_id: string | null;
  subgroup_id: string | null;
  topic_count: number;
};

export type StudentLearningTrajectorySummary = LearningTrajectorySummary & {
  total_task_count: number;
  completed_task_count: number;
  progress_percent: number;
};

export type LearningTrajectoryTaskType =
  | "single_choice"
  | "multiple_choice"
  | "matching"
  | "ordering";

export type LearningTrajectoryTaskTemplateKind =
  | "definition_choice"
  | "term_choice"
  | "property_multiple"
  | "relation_choice"
  | "requires_ordering"
  | "contains_multiple"
  | "matching_definition"
  | "contrast_choice"
  | "manual";

export type LearningTrajectoryTaskOption = {
  id: string;
  text: string;
  is_correct: boolean;
};

export type LearningTrajectoryTaskMatchingPair = {
  id: string;
  left: string;
  right: string;
};

export type LearningTrajectoryTaskOrderingItem = {
  id: string;
  text: string;
};

export type LearningTrajectoryTaskContent = {
  options?: LearningTrajectoryTaskOption[];
  pairs?: LearningTrajectoryTaskMatchingPair[];
  items?: LearningTrajectoryTaskOrderingItem[];
  correct_order_ids?: string[];
  correct_element_id?: string;
  correct_related_element_ids?: string[];
  distractor_element_ids?: string[];
};

export type LearningTrajectoryTaskElement = {
  element_id: string;
  name: string;
};

export type LearningTrajectoryTaskRelation = {
  relation_id: string;
  source_element_id: string;
  source_element_name: string;
  target_element_id: string;
  target_element_name: string;
  relation_type: KnowledgeElementRelationType;
};

export type LearningTrajectoryTask = {
  id: string;
  trajectory_id: string;
  trajectory_topic_id: string;
  topic_id: string;
  topic_name: string;
  title: string;
  prompt: string;
  difficulty: number;
  task_type: LearningTrajectoryTaskType;
  template_kind: LearningTrajectoryTaskTemplateKind;
  content: LearningTrajectoryTaskContent;
  created_at: string;
  updated_at: string;
  primary_element: LearningTrajectoryTaskElement;
  related_elements: LearningTrajectoryTaskElement[];
  checked_relations: LearningTrajectoryTaskRelation[];
};

export type StudentTaskProgress = {
  status: "not_started" | "in_progress" | "completed";
  attempts_count: number;
  last_score: number | null;
  best_score: number | null;
  completed_at: string | null;
  last_answer_payload: Record<string, unknown> | null;
  last_feedback: Record<string, unknown> | null;
};

export type StudentTaskElementState = {
  element_id: string;
  name: string;
  mastery_value: number;
};

export type StudentTaskChoiceOption = {
  id: string;
  text: string;
};

export type StudentTaskMatchingItem = {
  id: string;
  text: string;
};

export type StudentTaskContent = {
  options?: StudentTaskChoiceOption[];
  left_items?: StudentTaskMatchingItem[];
  right_items?: StudentTaskMatchingItem[];
  items?: StudentTaskMatchingItem[];
  placeholder?: string;
};

export type StudentAssignedTask = {
  id: string;
  task_instance_id: string | null;
  trajectory_id: string;
  trajectory_name: string;
  discipline_id: string;
  discipline_name: string;
  topic_id: string;
  topic_name: string;
  title: string;
  prompt: string;
  difficulty: number;
  task_type: LearningTrajectoryTaskType;
  template_kind: LearningTrajectoryTaskTemplateKind;
  content: StudentTaskContent;
  primary_element: StudentTaskElementState;
  related_elements: StudentTaskElementState[];
  checked_relations: LearningTrajectoryTaskRelation[];
  progress: StudentTaskProgress;
  recommendation_score: number | null;
};

export type StudentTopicControlElement = {
  element_id: string;
  name: string;
  threshold: number;
  mastery_value: number;
};

export type StudentTopicControl = {
  student_id: string;
  trajectory_id: string;
  topic_id: string;
  topic_name: string;
  topic_threshold: number;
  topic_mastery: number;
  is_unlocked: boolean;
   has_tasks: boolean;
   continue_practice_available: boolean;
   is_extra_practice: boolean;
  elements: StudentTopicControlElement[];
  current_task: StudentAssignedTask | null;
};

export type StudentTrajectoryMasteryElement = {
  element_id: string;
  threshold: number;
  mastery_value: number;
};

export type StudentTrajectoryMasteryTopic = {
  topic_id: string;
  position: number;
  threshold: number;
  mastery_value: number;
  is_unlocked: boolean;
  elements: StudentTrajectoryMasteryElement[];
};

export type StudentTrajectoryMastery = {
  student_id: string;
  trajectory_id: string;
  topics: StudentTrajectoryMasteryTopic[];
};

export type ViewMode =
  | {
      level: "topics";
    }
  | {
      level: "elements";
      topicId: string;
    };

export type GraphLayoutNodePosition = {
  x: number;
  y: number;
};

export type GraphLayoutPayload = {
  offset_x: number;
  offset_y: number;
  zoom: number | null;
  positions: Record<string, GraphLayoutNodePosition>;
};

export type GraphLayout = {
  id: string;
  scope_type: string;
  scope_id: string;
  scene_key: string;
  payload: GraphLayoutPayload;
  updated_at: string;
};

export type DetailChip = {
  label: string;
  tone: "topic" | "required" | "formed" | "relation";
};

export type DetailStat = {
  label: string;
  value: string | string[];
};

export type DetailCard = {
  title: string;
  subtitle?: string;
  description?: string;
  chips: DetailChip[];
  stats: DetailStat[];
  footnote?: string;
};

export type LegendItem = {
  label: string;
  hint: string;
  tone: "topic" | "required" | "formed" | "relation" | "line";
};

export type NodeAccentTone =
  | "topic"
  | "required"
  | "formed"
  | "know"
  | "can"
  | "master";

export type SceneNodeData = {
  entity: "topic" | "topic-focus" | "element";
  tone: "topic" | "required" | "formed";
  badgeTone?: NodeAccentTone;
  accentTone?: NodeAccentTone;
  badge: string;
  title: string;
  subtitle?: string;
  description?: string;
  metrics: string[];
  hint?: string;
  secondaryHint?: string;
  topicId?: string;
  actionTopicId?: string;
  isSelected?: boolean;
  isDisabled?: boolean;
  lockState?: "locked" | "open";
  sequenceNumber?: number;
  progressValue?: number;
  progressLabel?: string;
  onCardClick?: () => void;
  onHintClick?: () => void;
  onSecondaryHintClick?: () => void;
};

export type GraphScene = {
  key: string;
  title: string;
  subtitle: string;
  rootId: string;
  nodes: JsonNode[];
  lines: JsonLine[];
  defaultSelectedNodeId: string;
  detailsByNodeId: Record<string, DetailCard>;
  legend: LegendItem[];
};
