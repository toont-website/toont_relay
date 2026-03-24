-- Slack ↔ CS Tool 전면 연동 마이그레이션
-- 실행: docker compose exec mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" toont_relay < docker/migrate-cs-integration.sql

-- 1. MessageLog에서 contactId FK 해제 + 컬럼 삭제
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'toont_relay'
    AND TABLE_NAME = 'MessageLog'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME LIKE '%contactId%'
);

-- FK가 있으면 삭제 (이름이 다를 수 있으므로 동적으로)
SET @fk_name = (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'toont_relay'
    AND TABLE_NAME = 'MessageLog'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  LIMIT 1
);

SET @drop_fk = IF(@fk_name IS NOT NULL,
  CONCAT('ALTER TABLE `MessageLog` DROP FOREIGN KEY `', @fk_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @drop_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- contactId 컬럼 삭제 (존재하면)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'toont_relay'
    AND TABLE_NAME = 'MessageLog'
    AND COLUMN_NAME = 'contactId'
);

SET @drop_col = IF(@col_exists > 0,
  'ALTER TABLE `MessageLog` DROP COLUMN `contactId`',
  'SELECT 1'
);
PREPARE stmt FROM @drop_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Contact 테이블 삭제
DROP TABLE IF EXISTS `Contact`;

-- 3. DeadlineAlertLog 테이블 생성
CREATE TABLE IF NOT EXISTS `DeadlineAlertLog` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `stageId` VARCHAR(191) NOT NULL,
  `alertDate` VARCHAR(191) NOT NULL,
  `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DeadlineAlertLog_orderId_stageId_alertDate_key`(`orderId`, `stageId`, `alertDate`),
  INDEX `DeadlineAlertLog_alertDate_idx`(`alertDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT '✅ 마이그레이션 완료' AS result;
