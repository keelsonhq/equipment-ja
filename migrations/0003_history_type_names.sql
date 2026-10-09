-- 0003_history_type_names: an edit's history recorded the item type by id
-- (changes.typeId), which the history showed as a bare number. Edits now
-- record the type's name under changes.type; this rewrites the past ones the
-- same way, with today's names. An id no longer in item_types becomes null.

UPDATE events
SET detail = json_remove(
	json_set(detail, '$.changes.type', json_array(
		(SELECT name FROM item_types WHERE id = json_extract(events.detail, '$.changes.typeId[0]')),
		(SELECT name FROM item_types WHERE id = json_extract(events.detail, '$.changes.typeId[1]'))
	)),
	'$.changes.typeId'
)
WHERE kind = 'edit' AND json_type(detail, '$.changes.typeId') = 'array';
