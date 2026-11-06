-- Populate the public site configuration with the official Bliss Legacy contact
-- details and branch network. Existing deployments that already have a phone
-- and email configured are left untouched.
UPDATE app_settings
SET setting_value = '{"company_name":"Bliss Legacy Limited","tagline":"Your Future Begins With the Right Property.","phone":"0805 289 9920","whatsapp_number":"2349168630710","email":"hrblisslegacy@gmail.com","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","facebook":"https://blisslegacy.com","instagram":"","twitter":"","linkedin":"","branches":[{"name":"Head Office","city":"Benin City","state":"Edo State","type":"Corporate Headquarters","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","phone":"0805 289 9920","isHeadOffice":true},{"name":"Ikeja Branch","city":"Ikeja","state":"Lagos State","type":"Mainland Branch","address":"Plot 40, Adegbola Street, Anifowose, close to the Local Government","phone":"0805 289 9920","isHeadOffice":false},{"name":"Ajah Branch","city":"Ajah","state":"Lagos State","type":"Island & Lekki Corridor Branch","address":"Fladek Plaza, opposite Pump and Sell Bus Stop, Ado Road, Ajah","phone":"0805 289 9920","isHeadOffice":false},{"name":"Asaba Branch","city":"Asaba","state":"Delta State","type":"Delta State Regional Office","address":"Plot 2, Ikukaiwe Street, close to Christian Association of Nigeria (CAN) Building","phone":"0807 389 1911","isHeadOffice":false},{"name":"Ihama Branch","city":"Benin City","state":"Edo State","type":"GRA Branch","address":"102, Ihama Road, GRA, Benin City, close to Living Faith Church (Winners Church)","phone":"0807 389 3946","isHeadOffice":false},{"name":"Obakhavbaye Branch","city":"Benin City","state":"Edo State","type":"Commercial Office","address":"13, Obakhavbaye Street, off Oba Market Road, Benin City","phone":"0805 289 9920","isHeadOffice":false}]}',
    updated_at = datetime('now')
WHERE setting_key = 'site_config'
  AND (
    setting_value IS NULL
    OR setting_value = ''
    OR setting_value = '{}'
    OR json_extract(setting_value, '$.phone') IS NULL
    OR json_extract(setting_value, '$.phone') = ''
    OR json_extract(setting_value, '$.email') IS NULL
    OR json_extract(setting_value, '$.email') = ''
  );
