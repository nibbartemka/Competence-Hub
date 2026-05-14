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
  expert_ids: string[];
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
  login: string;
  is_active: boolean;
  group_id: string;
  subgroup_id: string | null;
};

export type Teacher = {
  id: string;
  name: string;
  login: string;
  is_active: boolean;
  discipline_ids: string[];
  group_ids: string[];
};

export type Expert = {
  id: string;
  name: string;
  login: string;
  is_active: boolean;
  discipline_ids: string[];
};

export type Admin = {
  id: string;
  name: string;
  login: string;
  is_active: boolean;
};

export type AuthRole = "student" | "teacher" | "admin" | "expert";

export type AuthLoginResponse = {
  role: AuthRole;
  user_id: string | null;
  display_name: string;
  login: string;
  session_id: string;
};

export type AuthSession = {
  role: AuthRole;
  user_id: string;
  display_name: string;
  login: string;
  expires_at: string;
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
  operation_ref: string | null;
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
  topic_id: string;
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

export type OperationContract = {
  id: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  example_input: Record<string, unknown>;
  executor: string;
  validator: string;
};

export type SkillAssessmentTask = {
  id: string;
  skill_element_id: string;
  skill_element_name: string;
  title: string;
  prompt: string;
  operation_ref: string;
  contract_title: string;
  input_payload: Record<string, unknown>;
  expected_output: unknown;
  realizes_knowledge_element_ids: string[];
  realizes_knowledge_element_names: string[];
  created_at: string;
  updated_at: string;
};

/** JSON-файл экспорта / тело запроса preview (совместимо с графом дисциплины). */
export type KnowledgeGraphExportFile = {
  format_version: number;
  exported_at?: string | null;
  source_discipline?: Discipline | null;
  topics: Topic[];
  topic_dependencies: TopicDependency[];
  knowledge_elements: KnowledgeElement[];
  topic_knowledge_elements: TopicKnowledgeElement[];
  knowledge_element_relations: KnowledgeElementRelation[];
};

export type ImportPreviewTopicRow = {
  export_id: string;
  name: string;
  description: string | null;
  is_duplicate: boolean;
  existing_topic_id: string | null;
};

export type ImportPreviewElementRow = {
  export_id: string;
  name: string;
  competence_type: CompetenceType;
  description: string | null;
  is_duplicate: boolean;
  existing_element_id: string | null;
};

export type ImportPreviewTopicDependencyRow = {
  export_id: string;
  prerequisite_topic_export_id: string;
  dependent_topic_export_id: string;
  relation_type: TopicDependencyRelationType;
  description: string | null;
  is_duplicate: boolean;
  prerequisite_is_duplicate: boolean;
  dependent_is_duplicate: boolean;
};

export type ImportPreviewTopicKnowledgeElementRow = {
  export_id: string;
  topic_export_id: string;
  element_export_id: string;
  role: TopicKnowledgeElementRole;
  note: string | null;
  is_duplicate: boolean;
  topic_is_duplicate: boolean;
  element_is_duplicate: boolean;
};

export type ImportPreviewKnowledgeElementRelationRow = {
  export_id: string;
  topic_export_id: string;
  source_element_export_id: string;
  target_element_export_id: string;
  relation_type: KnowledgeElementRelationType;
  description: string | null;
  is_duplicate: boolean;
  source_is_duplicate: boolean;
  target_is_duplicate: boolean;
};

export type KnowledgeGraphImportPreviewResponse = {
  target_discipline_id: string;
  topics: ImportPreviewTopicRow[];
  knowledge_elements: ImportPreviewElementRow[];
  topic_dependencies: ImportPreviewTopicDependencyRow[];
  topic_knowledge_elements: ImportPreviewTopicKnowledgeElementRow[];
  knowledge_element_relations: ImportPreviewKnowledgeElementRelationRow[];
};

export type KnowledgeGraphImportRequest = {
  export: KnowledgeGraphExportFile;
  selected_topic_export_ids: string[];
  selected_element_export_ids: string[];
  selected_topic_dependency_export_ids: string[];
  selected_topic_knowledge_element_export_ids: string[];
  selected_knowledge_element_relation_export_ids: string[];
};

export type KnowledgeGraphImportResult = {
  created_topics: number;
  created_knowledge_elements: number;
  created_topic_dependencies: number;
  created_topic_knowledge_elements: number;
  created_knowledge_element_relations: number;
  skipped_duplicate_topic_dependencies: number;
  skipped_duplicate_topic_knowledge_elements: number;
  skipped_duplicate_knowledge_element_relations: number;
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
  | "ordering"
  | "text";

export type LearningTrajectoryTaskTemplateKind =
  | "definition_choice"
  | "term_choice"
  | "property_multiple"
  | "relation_choice"
  | "requires_ordering"
  | "contains_multiple"
  | "matching_definition"
  | "contrast_choice"
  | "text_definition"
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
  accepted_answers?: string[];
  placeholder?: string;
  input_payload?: Record<string, unknown>;
  expected_output?: unknown;
  operation_ref?: string;
  contract_title?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
};

export type LearningTrajectoryTaskElement = {
  element_id: string;
  name: string;
};

export type LearningTrajectoryTaskRelation = {
  relation_id: string;
  topic_id?: string;
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
  input_payload?: Record<string, unknown>;
  contract_title?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
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

export type StudentTopicControlNextTopic = {
  topic_id: string;
  topic_name: string;
  position: number;
  is_unlocked: boolean;
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
  practice_stage: "know" | "can";
  knowledge_threshold_passed: boolean;
  skill_practice_available: boolean;
  show_next_topic_prompt: boolean;
  next_topic: StudentTopicControlNextTopic | null;
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
