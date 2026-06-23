from app.api.routes.learning_trajectory_tasks import _ascii_download_filename


def test_ascii_download_filename_keeps_ascii_names() -> None:
    assert _ascii_download_filename("report-final_2026.pdf") == "report-final_2026.pdf"


def test_ascii_download_filename_falls_back_for_cyrillic_name() -> None:
    file_name = _ascii_download_filename("Итоговый отчет.docx")

    assert file_name == "submission.docx"
    assert all(ord(char) < 128 for char in file_name)


def test_ascii_download_filename_preserves_available_ascii_parts() -> None:
    file_name = _ascii_download_filename("report_финал_2026.txt")

    assert file_name == "report__2026.txt"
    assert all(ord(char) < 128 for char in file_name)
