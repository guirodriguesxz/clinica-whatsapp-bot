import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import isoWeek from "dayjs/plugin/isoWeek.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isoWeek);
dayjs.locale("pt-br");

export default dayjs;
