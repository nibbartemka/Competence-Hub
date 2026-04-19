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

export type Discipline = {
  id: string;
  name: string;
  teacher_ids: string[];
  group_ids: string[];
};

export type Group = {
  id: string;
  name: string;
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
  description: string | null;
};

export type KnowledgeElement = {
  id: string;
  name: string;
  description: string | null;
  competence_type: CompetenceType;
};

export type TopicKnowledgeElement = {
  id: string;
  topic_id: string;
  element_id: string;
  role: TopicKnowledgeElementRole;
  note: string | null;
};

export type KnowledgeElementRelation = {
  id: string;
  source_element_id: string;
  target_element_id: string;
  relation_type: KnowledgeElementRelationType;
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

export type ViewMode =
  | {
      level: "topics";
    }
  | {
      level: "elements";
      topicId: string;
    };

export type DetailChip = {
  label: string;
  tone: "topic" | "required" | "formed" | "relation";
};

export type DetailStat = {
  label: string;
  value: string;
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
  topicId?: string;
  actionTopicId?: string;
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
