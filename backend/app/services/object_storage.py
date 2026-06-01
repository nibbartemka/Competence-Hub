import asyncio
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from uuid import UUID, uuid4

from minio import Minio
from minio.error import S3Error

from app.core import settings


class ObjectStorageError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredFilePayload:
    submission_kind: str
    storage_provider: str
    bucket_name: str
    object_key: str
    original_name: str
    mime_type: str
    size_bytes: int
    uploaded_at: str

    def as_dict(self) -> dict[str, object]:
        return {
            "submission_kind": self.submission_kind,
            "storage_provider": self.storage_provider,
            "bucket_name": self.bucket_name,
            "object_key": self.object_key,
            "original_name": self.original_name,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "uploaded_at": self.uploaded_at,
        }


_minio_client: Minio | None = None


def get_minio_client() -> Minio:
    global _minio_client
    if _minio_client is None:
        _minio_client = Minio(
            endpoint=settings.MINIO.ENDPOINT,
            access_key=settings.MINIO.ACCESS_KEY,
            secret_key=settings.MINIO.SECRET_KEY,
            secure=settings.MINIO.SECURE,
        )
    return _minio_client


def _ensure_bucket_sync() -> None:
    client = get_minio_client()
    if not client.bucket_exists(settings.MINIO.BUCKET):
        client.make_bucket(settings.MINIO.BUCKET)


async def ensure_submission_bucket(*, attempts: int = 10, delay_seconds: float = 1.5) -> None:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(_ensure_bucket_sync)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == attempts:
                break
            await asyncio.sleep(delay_seconds)
    raise ObjectStorageError("Не удалось подготовить bucket MinIO для файлов студентов.") from last_error


def _build_submission_object_key(task_id: UUID, student_id: UUID, original_name: str) -> str:
    return f"student-task-submissions/{task_id}/{student_id}/{uuid4().hex}_{original_name}"


def _upload_submission_sync(
    *,
    task_id: UUID,
    student_id: UUID,
    original_name: str,
    file_bytes: bytes,
    content_type: str,
) -> StoredFilePayload:
    object_key = _build_submission_object_key(task_id, student_id, original_name)
    client = get_minio_client()
    client.put_object(
        bucket_name=settings.MINIO.BUCKET,
        object_name=object_key,
        data=BytesIO(file_bytes),
        length=len(file_bytes),
        content_type=content_type,
    )
    return StoredFilePayload(
        submission_kind="file",
        storage_provider="minio",
        bucket_name=settings.MINIO.BUCKET,
        object_key=object_key,
        original_name=original_name,
        mime_type=content_type,
        size_bytes=len(file_bytes),
        uploaded_at=datetime.utcnow().isoformat(),
    )


async def upload_student_submission(
    *,
    task_id: UUID,
    student_id: UUID,
    original_name: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, object]:
    payload = await asyncio.to_thread(
        _upload_submission_sync,
        task_id=task_id,
        student_id=student_id,
        original_name=original_name,
        file_bytes=file_bytes,
        content_type=content_type,
    )
    return payload.as_dict()


def _download_submission_sync(*, bucket_name: str, object_key: str) -> bytes:
    client = get_minio_client()
    response = client.get_object(bucket_name, object_key)
    try:
        return response.read()
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchBucket", "NoSuchObject"}:
            raise FileNotFoundError(object_key) from exc
        raise
    finally:
        response.close()
        response.release_conn()


async def download_student_submission(*, bucket_name: str, object_key: str) -> bytes:
    try:
        return await asyncio.to_thread(
            _download_submission_sync,
            bucket_name=bucket_name,
            object_key=object_key,
        )
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchBucket", "NoSuchObject"}:
            raise FileNotFoundError(object_key) from exc
        raise ObjectStorageError("Не удалось скачать файл из MinIO.") from exc
