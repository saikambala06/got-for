"""
Resume parsing pipeline.

Six explicit stages, each independently testable:

    FileValidator     validator.py   is this a real, safe, parseable file?
    TextExtractor     extractor.py   document -> geometric line model
    OCREngine         ocr.py         image-only documents -> text
    DataCleaner       cleaner.py     repair extraction artefacts
    SectionSegmenter  segmenter.py   line model -> titled sections + hierarchy
    NEREngine         ner.py         entity recognition over segmented content
    JSONFormatter     formatter.py   entities -> the public JSON schema

`pipeline.parse_document()` wires them together.
"""

__version__ = "2.0.0"
