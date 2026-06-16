import logging


class SanitizeUvicornReloadPathFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if str(record.getMessage()).startswith("Will watch for changes in these directories:"):
            record.msg = "Will watch for changes"
            record.args = ()
        return True


def install_uvicorn_reload_path_filter() -> None:
    logger = logging.getLogger("uvicorn.error")
    if not any(isinstance(item, SanitizeUvicornReloadPathFilter) for item in logger.filters):
        logger.addFilter(SanitizeUvicornReloadPathFilter())
