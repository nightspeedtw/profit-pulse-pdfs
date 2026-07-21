
WITH picked AS (
  SELECT pp.product_id, pp.product_kind, pp.market,
    (ARRAY[549,599,649,699,749,799,849,899,949,999,1049,1099,1149,1199])[
      1 + (('x'||substr(md5(pp.product_id::text||'r3'),1,8))::bit(32)::int & 2147483647) % 14
    ] AS reg,
    (ARRAY[249,279,299,349,379,399,449,479,499,549,599,649])[
      1 + (('x'||substr(md5(pp.product_id::text||'c3'),1,8))::bit(32)::int & 2147483647) % 12
    ] AS camp
  FROM product_pricing pp
)
UPDATE product_pricing pp SET
  regular_price_cents = p.reg,
  campaign_price_cents = CASE WHEN pp.active_campaign_id IS NOT NULL
    THEN LEAST(p.camp, p.reg - 50) ELSE NULL END,
  effective_price_cents = CASE WHEN pp.active_campaign_id IS NOT NULL
    THEN GREATEST(199, LEAST(p.camp, p.reg - 50)) ELSE p.reg END,
  updated_at = now()
FROM picked p
WHERE pp.product_id = p.product_id
  AND pp.product_kind = p.product_kind
  AND pp.market = p.market;
