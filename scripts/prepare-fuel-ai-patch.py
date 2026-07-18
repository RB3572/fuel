from pathlib import Path

path = Path('scripts/apply-fuel-ai-mobile-fixes.py')
text = path.read_text()
text = text.replace('old_generate = """', 'old_generate = r"""', 1)
text = text.replace('new_generate = """', 'new_generate = r"""', 1)
path.write_text(text)
